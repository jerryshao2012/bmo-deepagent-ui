import TokenSignIn from "../../chat/TokenSignIn";

export default function LoginSuccessPage({
  searchParams,
}: {
  searchParams: { token?: string | string[] | undefined };
}) {
  const token =
    typeof searchParams.token === "string" ? searchParams.token : undefined;

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-slate-900">
            Missing token
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            An authentication token was not found. Please{" "}
            <a
              href="/login"
              className="text-blue-600 underline"
            >
              {" "}
              sign in again
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <TokenSignIn
      token={token}
      redirectTo="/chat"
    />
  );
}
