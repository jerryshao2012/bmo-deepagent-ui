"use client";

import { useEffect } from "react";
import {
  type AuthenticatedUser,
  writeRememberedLogin,
} from "@/lib/remembered-login";

export default function RememberedLoginCapture({
  user,
}: {
  user: AuthenticatedUser;
}) {
  useEffect(() => {
    writeRememberedLogin({
      provider: user.provider,
      name: user.name,
      email: user.email,
      avatarUrl: user.image,
    });
  }, [user.email, user.image, user.name, user.provider]);

  return null;
}
