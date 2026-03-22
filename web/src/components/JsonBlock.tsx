type JsonBlockProps = {
  value: unknown;
};

export function JsonBlock({ value }: JsonBlockProps) {
  return (
    <pre className="json-shell">{JSON.stringify(value, null, 2)}</pre>
  );
}
