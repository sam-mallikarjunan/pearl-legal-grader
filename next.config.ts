import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withWorkflow(config);
