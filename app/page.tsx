import GraderApp from "../components/GraderApp";
import { scanConfiguration } from "../lib/server/scan-config";
import { getActiveConfig } from "../lib/server/config-store";
import { DEFAULT_RELEASE } from "../lib/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let release = DEFAULT_RELEASE;
  let configurationAvailable = true;
  try {
    release = (await getActiveConfig()).release;
  } catch {
    configurationAvailable = false;
    console.error("grader_configuration_load_unavailable");
  }
  return (
    <GraderApp
      websiteScansEnabled={scanConfiguration().enabled}
      publishedRelease={release}
      configurationAvailable={configurationAvailable}
    />
  );
}
