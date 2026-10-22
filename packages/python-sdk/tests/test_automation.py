import hashlib
import hmac
import io
import json
import unittest
from unittest.mock import Mock
from agfs_sdk import AgfsClient, AgfsError, ResourceLimitError, WorkflowError, diagnose_error, read_lines, read_json_lines, stage_draft, verify_webhook, with_run


class Response(io.BytesIO):
    def __init__(self, data, status=200, headers=None, chunk=None):
        super().__init__(data)
        self.status, self.headers, self.chunk = status, headers or {}, chunk

    def read(self, size=-1):
        return super().read(min(size, self.chunk) if self.chunk and size >= 0 else size)


def line_client(text, chunk=1):
    client = AgfsClient('fixture', retries=0)
    content = text.encode()
    responses = []

    def request(path, **options):
        if '/list?' in path:
            return Response(json.dumps({'path': '/', 'entries': [{'path': '/log', 'kind': 'file', 'size': len(content), 'etag': 'version'}]}).encode())
        start, end = map(int, options['headers']['Range'][6:].split('-'))
        response = Response(content[start:end+1], 206, {'Content-Range': f'bytes {start}-{end}/{len(content)}', 'ETag': 'version'}, chunk)
        responses.append(response)
        return response

    client.request = Mock(side_effect=request)
    return client, responses


class AutomationTests(unittest.TestCase):
    def test_utf8_checkpoint_resume_and_early_close(self):
        client, responses = line_client('é😀\r\nsecond\nlast')
        rows = read_lines(client, '/log')
        first = next(rows)
        self.assertEqual(first['text'], 'é😀')
        self.assertEqual(first['checkpoint']['offset'], 8)
        rows.close()
        self.assertTrue(responses[0].closed)
        remaining = list(read_lines(client, '/log', checkpoint=first['checkpoint']))
        self.assertEqual([(row['text'], row['line']) for row in remaining], [('second', 2), ('last', 3)])
        self.assertTrue(responses[-1].closed)

    def test_invalid_boundaries_versions_and_byte_limits(self):
        client, responses = line_client('abc\ndef\n')
        checkpoint = {'version': 1, 'origin': client.base_url, 'path': '/log', 'etag': 'version', 'offset': 2, 'line': 1}
        with self.assertRaisesRegex(ValueError, 'line boundary'):
            list(read_lines(client, '/log', checkpoint=checkpoint))
        with self.assertRaises(AgfsError) as raised:
            list(read_lines(client, '/log', checkpoint={**checkpoint, 'etag': 'changed'}))
        self.assertEqual(raised.exception.status, 412)
        with self.assertRaisesRegex(ResourceLimitError, 'max_line_bytes'):
            list(read_lines(client, '/log', max_line_bytes=2))
        with self.assertRaisesRegex(ResourceLimitError, 'max_bytes'):
            list(read_lines(client, '/log', max_bytes=4))
        self.assertTrue(all(response.closed for response in responses))

    def test_jsonl_validation_errors_and_close(self):
        client, responses = line_client('null\n{"a":1}\nNaN\n', 2)
        rows = read_json_lines(client, '/log')
        self.assertIsNone(next(rows)['value'])
        self.assertEqual(next(rows)['value'], {'a': 1})
        with self.assertRaisesRegex(ValueError, '/log:3'):
            next(rows)
        self.assertTrue(responses[-1].closed)
        with self.assertRaises(ResourceLimitError):
            list(read_json_lines(client, '/log', max_records=1))

    def test_webhook_rotation_exact_body_and_replay(self):
        body = '{"event":"é"}'.encode()
        signature = hmac.new(b'secret', b'100.' + body, hashlib.sha256).hexdigest()
        headers = {'timestamp': '100', 'signature': 'v1=' + '0' * 64 + ',v1=' + signature, 'now_seconds': 100}
        self.assertTrue(verify_webhook('secret', body, **headers))
        self.assertFalse(verify_webhook('secret', body + b' ', **headers))
        self.assertFalse(verify_webhook('secret', body, **{**headers, 'now_seconds': 401}))
        self.assertFalse(verify_webhook('secret', body, **{**headers, 'signature': 'x' * 161}))
        self.assertFalse(verify_webhook('secret', body, **{**headers, 'timestamp': 'nan'}))

    def test_draft_prevalidation_and_partial_recovery(self):
        client = Mock()
        client.create_draft.return_value = {'id': 'draft_1'}
        invalid = {'name': 'review', 'path': '/safe', 'changes': [{'path': '/safe/a', 'operation': 'write', 'content': ''}, {'path': '/outside', 'operation': 'delete'}]}
        with self.assertRaises(ValueError):
            stage_draft(client, invalid)
        client.create_draft.assert_not_called()
        valid = {**invalid, 'changes': [invalid['changes'][0], {'path': '/safe/b', 'operation': 'delete'}]}
        client.json.side_effect = [{}, AgfsError(409, 'changed')]
        with self.assertRaises(WorkflowError) as raised:
            stage_draft(client, valid)
        self.assertEqual(raised.exception.resource_id, 'draft_1')
        self.assertEqual(raised.exception.completed, 1)
        self.assertEqual(client.json.call_args_list[0].args[2]['content'], '')

    def test_run_lifecycle_no_completion_on_callback_failure(self):
        client = Mock()
        client.start_run.return_value = {'id': 'run_1'}
        cause = RuntimeError('job failed')
        with self.assertRaises(WorkflowError) as raised:
            with_run(client, 'job', '/', Mock(side_effect=cause))
        self.assertIs(raised.exception.__cause__, cause)
        client.complete_run.assert_not_called()
        self.assertEqual(with_run(client, 'job', '/', lambda run: run['id']), {'id': 'run_1', 'value': 'run_1'})
        client.complete_run.assert_called_once_with('run_1')

    def test_error_categories_preserve_status_and_retryability(self):
        self.assertEqual(diagnose_error(AgfsError(412, 'changed'))['exitCode'], 5)
        self.assertFalse(diagnose_error(AgfsError(412, 'changed'))['retryable'])
        self.assertEqual(diagnose_error(ResourceLimitError('limit'))['category'], 'budget')
        self.assertEqual(diagnose_error(TimeoutError('deadline'))['exitCode'], 124)

    def test_all_line_checkpoint_fields_required_before_transport(self):
        client, _ = line_client('one\ntwo\n')
        rows = read_lines(client, '/log')
        checkpoint = next(rows)['checkpoint']
        rows.close()
        for field in checkpoint:
            with self.subTest(field=field):
                partial = {key: value for key, value in checkpoint.items() if key != field}
                client.request.reset_mock()
                for reader in (read_lines, read_json_lines):
                    with self.assertRaises(ValueError):
                        next(reader(client, '/log', checkpoint=partial))
                client.request.assert_not_called()

    def test_line_checkpoint_types_bounds_and_invariants_before_transport(self):
        client, _ = line_client('one\ntwo\n')
        checkpoint = {'version': 1, 'origin': client.base_url, 'path': '/log', 'etag': 'version', 'offset': 4, 'line': 1}
        invalid = [('version', True), ('version', 1.0), ('origin', 1), ('path', '/elsewhere'), ('etag', 1), ('etag', ''),
                   ('etag', 'x\n'), ('etag', 'x' * 257), ('offset', None), ('offset', -1), ('offset', 1.5),
                   ('offset', 20 * 1024**3 + 1), ('offset', 0), ('line', False), ('line', 0), ('line', 5), ('line', 2**53)]
        for field, value in invalid:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                next(read_lines(client, '/log', checkpoint={**checkpoint, field: value}))
        class Deceptive(dict):
            def __getitem__(self, key):
                raise AssertionError('Must not invoke a custom checkpoint accessor')
        for malformed in (False, [], {}, Deceptive(checkpoint)):
            with self.subTest(malformed=type(malformed)), self.assertRaises(ValueError):
                next(read_lines(client, '/log', checkpoint=malformed))
        client.request.assert_not_called()

    def test_line_checkpoint_snapshot_and_valid_eof(self):
        client, _ = line_client('\ufeffé😀\r\nlast\r')
        rows = read_lines(client, '/log')
        first = next(rows)
        rows.close()
        checkpoint, original = dict(first['checkpoint']), client.request.side_effect
        def mutate(path, **options):
            checkpoint.update(offset=0, line=0, etag='tampered')
            return original(path, **options)
        client.request.side_effect = mutate
        remaining = list(read_lines(client, '/log', checkpoint=checkpoint))
        self.assertEqual([(row['text'], row['line']) for row in remaining], [('last\r', 2)])
        client.request.reset_mock()
        self.assertEqual(list(read_lines(client, '/log', checkpoint=remaining[0]['checkpoint'])), [])
        client.request.assert_called_once()
        self.assertIn('/list?', client.request.call_args.args[0])

    def test_nested_runs_keep_underlying_diagnostics_and_all_recovery_ids(self):
        for cause, category, code in [(AgfsError(412, 'changed'), 'conflict', 5), (ResourceLimitError('limit'), 'budget', 8),
                                      (KeyboardInterrupt(), 'cancelled', 130), (TimeoutError('deadline'), 'timeout', 124),
                                      (RuntimeError('bug'), 'failure', 1), (TypeError('bad call'), 'invalid_input', 2)]:
            with self.subTest(category=category):
                client, calls = Mock(), []
                client.start_run.side_effect = [{'id': f'run_{i}'} for i in range(6)]
                def nested(depth):
                    def work(run):
                        calls.append(run['id'])
                        if depth:
                            return nested(depth - 1)
                        raise cause
                    return with_run(client, 'nested', '/', work)
                with self.assertRaises(WorkflowError) as raised:
                    nested(5)
                result = diagnose_error(raised.exception)
                self.assertEqual((result['category'], result['exitCode']), (category, code))
                self.assertEqual(result['resources'], [{'kind': 'run', 'resourceId': f'run_{i}', 'completed': 0} for i in range(6)])
                if category == 'conflict':
                    self.assertEqual(result['status'], 412)
                leaf = raised.exception
                while leaf.__cause__ is not None:
                    leaf = leaf.__cause__
                self.assertIs(leaf, cause)
                self.assertEqual(len(calls), 6)
                client.complete_run.assert_not_called()

    def test_deep_causes_and_cycles_are_iterative(self):
        error = ResourceLimitError('limit')
        for i in range(10000):
            error = WorkflowError('wrapped', 'draft_same', i % 3, error)
        result = diagnose_error(error)
        self.assertEqual(result['category'], 'budget')
        self.assertEqual(result['resources'], [{'resourceId': 'draft_same', 'completed': 2}])
        a = WorkflowError('a', 'draft_a', 1, None)
        b = WorkflowError('b', 'run_b', 0, a)
        a.__cause__ = b
        result = diagnose_error(a)
        self.assertEqual(result['category'], 'failure')
        self.assertEqual({item['resourceId'] for item in result['resources']}, {'draft_a', 'run_b'})
        conflict = AgfsError(412, 'changed')
        conflict.__cause__, a.__cause__ = a, conflict
        self.assertEqual(diagnose_error(a)['category'], 'conflict')

    def test_control_c_draft_records_only_acknowledged_progress(self):
        batch = {'name': 'review', 'path': '/', 'changes': [{'path': '/a', 'operation': 'delete'}, {'path': '/b', 'operation': 'delete'}]}
        for completed in (0, 1):
            with self.subTest(completed=completed):
                client, cause = Mock(), KeyboardInterrupt()
                client.create_draft.return_value = {'id': 'draft_known'}
                client.json.side_effect = [{}] * completed + [cause]
                with self.assertRaises(WorkflowError) as raised:
                    stage_draft(client, batch)
                self.assertIs(raised.exception.__cause__, cause)
                result = diagnose_error(raised.exception)
                self.assertEqual((result['resourceId'], result['completed'], result['category'], result['exitCode']), ('draft_known', completed, 'cancelled', 130))
                self.assertEqual(client.json.call_count, completed + 1)

    def test_control_c_run_completion_keeps_id_without_retry(self):
        client, cause = Mock(), KeyboardInterrupt()
        client.start_run.return_value = {'id': 'run_known'}
        client.complete_run.side_effect = cause
        work = Mock(return_value=123)
        with self.assertRaises(WorkflowError) as raised:
            with_run(client, 'job', '/', work)
        self.assertIs(raised.exception.__cause__, cause)
        self.assertEqual(diagnose_error(raised.exception)['resourceId'], 'run_known')
        self.assertEqual(diagnose_error(raised.exception)['exitCode'], 130)
        work.assert_called_once()
        client.complete_run.assert_called_once_with('run_known')

    def test_control_c_nested_draft_keeps_all_confirmed_resources(self):
        client, cause = Mock(), KeyboardInterrupt()
        client.start_run.side_effect = [{'id': f'run_{i}'} for i in range(6)]
        client.create_draft.return_value = {'id': 'draft_known'}
        client.json.side_effect = [{}, cause]
        batch = {'name': 'review', 'path': '/', 'changes': [{'path': '/a', 'operation': 'delete'}, {'path': '/b', 'operation': 'delete'}]}
        def nested(depth):
            return with_run(client, 'nested', '/', lambda run: nested(depth - 1) if depth else stage_draft(client, batch))
        with self.assertRaises(WorkflowError) as raised:
            nested(5)
        result = diagnose_error(raised.exception)
        self.assertEqual((result['category'], result['exitCode']), ('cancelled', 130))
        self.assertEqual(len(result['resources']), 7)
        self.assertIn({'kind': 'draft', 'resourceId': 'draft_known', 'completed': 1}, result['resources'])
        client.complete_run.assert_not_called()

    def test_system_exit_retains_native_identity_code_and_nested_draft_progress(self):
        batch = {'name': 'review', 'path': '/', 'changes': [{'path': '/a', 'operation': 'delete'}, {'path': '/b', 'operation': 'delete'}]}
        for code, diagnostic_code in [(None, 0), (0, 0), (7, 7), ('stop', 1)]:
            with self.subTest(code=code):
                client, cause = Mock(), SystemExit(code)
                client.start_run.side_effect = [{'id': f'run_{i}'} for i in range(6)]
                client.create_draft.return_value = {'id': 'draft_known'}
                client.json.side_effect = [{}, cause]
                def nested(depth):
                    return with_run(client, 'nested', '/', lambda run: nested(depth - 1) if depth else stage_draft(client, batch))
                with self.assertRaises(SystemExit) as raised:
                    nested(5)
                self.assertIs(raised.exception, cause)
                self.assertEqual(raised.exception.code, code)
                result = diagnose_error(raised.exception)
                self.assertEqual((result['category'], result['exitCode']), ('terminated', diagnostic_code))
                self.assertEqual(len(result['resources']), 7)
                self.assertIn({'kind': 'draft', 'resourceId': 'draft_known', 'completed': 1}, result['resources'])
                client.complete_run.assert_not_called()

    def test_termination_before_acknowledged_creation_does_not_invent_recovery(self):
        for cause in (KeyboardInterrupt(), SystemExit(7), GeneratorExit()):
            client = Mock()
            client.start_run.side_effect = cause
            work = Mock()
            with self.assertRaises(type(cause)) as raised:
                with_run(client, 'job', '/', work)
            self.assertIs(raised.exception, cause)
            self.assertNotIn('resources', diagnose_error(cause))
            work.assert_not_called()
            client.complete_run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
