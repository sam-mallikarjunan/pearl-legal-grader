import GraderApp from "../components/GraderApp";
import { scanConfiguration } from "../lib/server/scan-config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <GraderApp websiteScansEnabled={scanConfiguration().enabled} />;
}
