import { SectionLoading } from '@/components/section-loading';

// Loading fallback for the customer area (wraps the page in Suspense).
export default function CustomerLoading() {
  return <SectionLoading />;
}
