import type { Metadata } from "next";
import { SiteFooter } from "@/components/Docs";

export const metadata: Metadata = { title: "Safe play · CardQuest", description: "How to play CardQuest safely." };

export default function SafePlay() {
  return (
    <div className="docs">
      <h1>Safe play</h1>
      <p>CardQuest sends you outside. A crate is never worth a risk. Please read this before you play.</p>

      <h2>Look up, not down</h2>
      <ul>
        <li>Stop walking before you check the map or open a crate.</li>
        <li>Never use the game while driving, cycling or riding. Passengers only.</li>
        <li>Watch for traffic, stairs, kerbs and uneven ground.</li>
      </ul>

      <h2>Go only where you are allowed</h2>
      <ul>
        <li>Stay on public footpaths and open spaces. Do not enter private property, construction sites, railways, roads without a footpath, or anywhere closed.</li>
        <li>If a crate looks like it is somewhere unsafe or off limits, skip it. There will be more.</li>
        <li>Respect other people&apos;s space. Do not film or follow anyone, and keep noise down near homes.</li>
      </ul>

      <h2>Stay safe</h2>
      <ul>
        <li>Play in daylight where you can, and avoid empty or unfamiliar places at night.</li>
        <li>Tell someone where you are going, and consider playing with a friend.</li>
        <li>Be careful showing your phone in crowded places.</li>
        <li>Keep your phone charged and your seed phrase private: <b>no one from CardQuest will ever ask for your seed phrase or private key.</b></li>
      </ul>

      <h2>Protect your wallet</h2>
      <ul>
        <li>Connecting only needs a sign-in message. Reject anything that asks you to approve a transaction you do not understand.</li>
        <li>Use a wallet you are comfortable receiving prizes in.</li>
      </ul>

      <h2>Play fair</h2>
      <p>Fake GPS and teleporting are against the rules and get accounts frozen. Please play for real, safely.</p>

      <h2>Weather and health</h2>
      <p>Skip play in storms, extreme heat or cold, and take breaks and water on long walks.</p>
      <SiteFooter />
    </div>
  );
}
