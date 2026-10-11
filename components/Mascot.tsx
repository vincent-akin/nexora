import { MASCOT_SVG } from '@/lib/icons';

export default function Mascot() {
  return <span aria-hidden="true" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: MASCOT_SVG }} />;
}
