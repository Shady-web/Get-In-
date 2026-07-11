import { redirect } from "next/navigation";

// The home page is the app itself (public, browsable without an account).
// It lives at /match; "/" just forwards there.
export default function Home() {
  redirect("/match");
}
