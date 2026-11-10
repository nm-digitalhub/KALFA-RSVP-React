import { SectionLoading } from '@/components/section-loading';

// Loading fallback for the admin area (wraps the page in Suspense).
export default function AdminLoading() {
  return <SectionLoading />;
}
