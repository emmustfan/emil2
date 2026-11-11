import { LessonBookPage } from "@/components/admin/lesson-book-page";
export default async function TopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LessonBookPage topicId={id} />;
}
