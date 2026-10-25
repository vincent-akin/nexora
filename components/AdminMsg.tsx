/** The result of the last admin action, passed back on the URL by the server action. */
export default function AdminMsg({ msg, bad }: { msg?: string; bad?: string }) {
  if (!msg) return null;
  return <p className={`adm-msg${bad ? ' bad' : ''}`} role="status">{msg}</p>;
}
