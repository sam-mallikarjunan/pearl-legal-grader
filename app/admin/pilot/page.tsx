import AdminPilot from "../../../components/AdminPilot";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "First improvement pilot · Pearl Practice Grader",
  robots: { index: false, follow: false },
};

export default function PilotAdminPage() {
  return <AdminPilot />;
}
