type SSRProps = {
  readonly text: string;
};

export function SSR({ text }: SSRProps) {
  return <div className="p-4 rounded-xl bg-card shadow">{text}</div>;
}
