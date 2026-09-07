import unittest
from agfs_sdk import AgfsClient
class ClientTests(unittest.TestCase):
    def test_origins(self):
        for origin in ['http://example.com','https://user:pass@agfs.dev','https://agfs.dev/path','https://agfs.dev#fragment']:
            with self.assertRaises(ValueError):
                AgfsClient('secret',origin)
        AgfsClient('secret','http://localhost:8787')
    def test_pagination(self):
        client=AgfsClient('secret')
        client.search=lambda **filters: {'results':[filters['cursor']],'nextCursor':'second' if filters['cursor'] is None else None}
        self.assertEqual(list(client.search_all()),[None,'second'])
    def test_arbitrary_paths(self):
        with self.assertRaises(ValueError):
            AgfsClient('secret').request('//evil.com/api/v1')
    def test_conditional_empty_upload(self):
        import tempfile
        client=AgfsClient('secret')
        def capture(path,method,body):
            self.assertIsNone(body['ifMatch'])
            raise RuntimeError('captured')
        client.json=capture
        with tempfile.NamedTemporaryFile() as file:
            with self.assertRaisesRegex(RuntimeError,'captured'):
                client.upload_file(file.name,'/new',if_match=None)
if __name__=='__main__':unittest.main()
