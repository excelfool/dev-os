export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-caption text-danger-700">
      {message}
    </p>
  );
}
