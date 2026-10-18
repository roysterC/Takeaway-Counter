import { redirect } from "next/navigation";

/** The front door is the login page, which sends a signed-in user on to the orders. */
export default function Home() {
  redirect("/login");
}
