import { lineIcon } from '@/lib/icons';

/** Single-colour line icon for the platform shell. Inherits the surrounding text colour. */
export default function LineIcon({ name, size = 18 }: { name: string; size?: number }) {
  return <span aria-hidden="true" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: lineIcon(name, size) }} />;
}
