export default function Flash({ msg }: { msg?: string }) {
  return msg ? <p className="alert info" role="status">{msg}</p> : null;
}
