import { LessonBookPage } from "@/components/admin/lesson-book-page";
export default async function SubjectEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { id } = await params,
    query = await searchParams;
  return <LessonBookPage subjectId={id} create={query.new === "1"} />;
}
