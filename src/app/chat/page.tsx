import { auth } from "@/auth";
import ChatPage from "../chat-page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <ChatPage user={session.user} />;
}
