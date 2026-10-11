import { icon } from '@/lib/icons';

/** Inline SVG icon from the shared set (trusted static markup). */
export default function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <span aria-hidden="true" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: icon(name, size) }} />;
}
