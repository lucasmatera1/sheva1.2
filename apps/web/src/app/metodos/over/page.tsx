import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MetodosOverAliasPage() {
  redirect("/methods/over");
}