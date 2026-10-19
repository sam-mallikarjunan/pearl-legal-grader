import type { Metadata } from "next";
import BenchmarkExplorer from "../../components/BenchmarkExplorer";
import "./benchmarks.css";

export const metadata: Metadata = {
  title: "Practice benchmarks and calculators | Practice Grader",
  description:
    "Source-linked law practice benchmarks, clear definitions, and private funnel and cash-flow calculators.",
};

export default function BenchmarksPage() {
  return <BenchmarkExplorer />;
}
