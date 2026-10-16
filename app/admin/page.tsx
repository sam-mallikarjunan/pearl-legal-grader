import PublishedAdmin from "../../components/PublishedAdmin";
import AdminOperations from "../../components/AdminOperations";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Methodology administration · Pearl Practice Grader",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return (
    <>
      <PublishedAdmin />
      <AdminOperations />
    </>
  );
}
