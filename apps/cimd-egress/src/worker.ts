import { Container, getContainer } from "@cloudflare/containers";
import { MetadataRequestLifecycle } from "./lifecycle";
import program from "../dist/server.txt";
export class MetadataContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30s";
  entrypoint = ["node", "--input-type=module", "-e", program];

  private readonly requests = new MetadataRequestLifecycle(
    (request) => this.containerFetch(request),
    async () => {
      // The process keeps no state. Terminate it once all buffered responses
      // are complete rather than waiting for SIGTERM or the idle alarm.
      await this.destroy();
    },
  );

  override fetch(request: Request): Promise<Response> {
    return this.requests.fetch(request);
  }
}
export default {
  async fetch(
    request: Request,
    env: { METADATA: DurableObjectNamespace<MetadataContainer> },
  ) {
    return getContainer(env.METADATA, "metadata").fetch(request);
  },
};
