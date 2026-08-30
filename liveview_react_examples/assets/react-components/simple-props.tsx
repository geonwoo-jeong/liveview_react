type User = {
  readonly age: number;
  readonly name: string;
};

type SimplePropsProps = {
  readonly user: User;
};

export function SimpleProps({ user }: SimplePropsProps) {
  return (
    <div>
      An example of how to pass a struct to React:
      {JSON.stringify(user)}
    </div>
  );
}
