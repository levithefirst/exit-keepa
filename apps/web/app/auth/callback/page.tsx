"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../../../lib/wallet";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  not_configured: "This sign-in method isn't set up yet on this deployment.",
  invalid_state: "This sign-in link expired or was already used. Please try again.",
  missing_code: "Sign-in didn't complete. Please try again.",
  token_exchange_failed: "Couldn't finish signing in with the provider. Please try again.",
  userinfo_failed: "Signed in, but couldn't read the account's profile. Please try again.",
};

/** Where every social sign-in (Google/X) lands after the provider's own
 * consent screen - apps/api/src/routes/oauth.ts redirects here with
 * either a `#token=...` fragment (success) or a `?error=...` query param
 * (failure), and this page is the only place that ever reads either. */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { completeSocialLogin } = useWallet();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const queryError = query.get("error");
    if (queryError) {
      setError(ERROR_MESSAGES[queryError] ?? "Sign-in didn't complete. Please try again.");
      return;
    }

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("token");
    const provider = hash.get("provider");
    const identity = hash.get("identity");
    const label = hash.get("label");

    if (token && identity && (provider === "google" || provider === "x")) {
      completeSocialLogin({ token, provider, identity, label: label ?? provider });
      // Drop the token out of the URL bar/history before navigating away.
      window.history.replaceState(null, "", window.location.pathname);
      router.replace("/dashboard");
      return;
    }

    setError("Sign-in didn't complete. Please try again.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      {error ? (
        <>
          <h1 className="text-balance font-display text-xl font-bold text-cream-50">Sign-in didn&apos;t complete</h1>
          <p className="text-pretty text-sm text-danger">{error}</p>
          <a href="/" className="inline-block text-sm text-mint-300 underline hover:text-mint-200">
            Back to Exit Keepa
          </a>
        </>
      ) : (
        <p className="text-pretty text-sm text-cream-300">Finishing sign-in...</p>
      )}
    </div>
  );
}
