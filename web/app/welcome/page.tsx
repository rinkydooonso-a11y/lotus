import { redirect } from "next/navigation";

// Old landing page URL; the How it works page replaces it.
export default function Welcome() { redirect("/how"); }
