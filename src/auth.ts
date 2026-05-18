import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"

if (process.env.NODE_ENV === "development") {
  if (!process.env.AUTH_GITHUB_ID || !process.env.AUTH_GITHUB_SECRET) {
    console.warn("Missing GitHub OAuth environment variables");
  }
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
    console.warn("Missing Google OAuth environment variables");
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub,
    Google,
  ],
  secret: process.env.AUTH_SECRET || "secret",
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login", 
  },
})
