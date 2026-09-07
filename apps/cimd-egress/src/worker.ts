import { Container, getContainer } from "@cloudflare/containers";
import program from "../dist/server.txt";
export class MetadataContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30s";
  entrypoint = ["node", "--input-type=module", "-e", program];
}
export default {
  async fetch(
    request: Request,
    env: { METADATA: DurableObjectNamespace<MetadataContainer> },
  ) {
    return getContainer(env.METADATA, "metadata").fetch(request);
  },
};
