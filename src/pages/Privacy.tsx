import { useEffect } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/shell/Logo";

const sections: { title: string; body: string[] }[] = [
  { title: "What Unfuel keeps", body: [
    "Your name, email address and profile picture, from Google when you sign in.",
    "Your fill-ups: date, amount, fuel quantity, odometer reading, notes, and the photos you add.",
    "Where a fill-up was made, if you allow location, and the fuel station it was at.",
    "Your vehicles and settings.",
    "How the app is used: how often it is opened, for how long, on what kind of device, and which screens. Counts only.",
  ] },
  { title: "Who else sees it", body: [
    "Convex stores the data and runs the app's server. Vercel serves the app.",
    "Google signs you in. Google Maps Platform is asked for the fuel stations near a fill-up: it is sent the fill-up's coordinates and the station name on the bill, and nothing that identifies you.",
    "Anthropic reads your photos if AI reading is switched on for your account. The photos are sent to its Claude model to be read and are not used by Unfuel for anything else. With AI reading off, photos are read on your own device and sent to nobody to be read.",
    "UnMoney receives a fill-up's amount, date and description only if you connect it and send one.",
    "The person who runs Unfuel can see who has an account and how the app is used, as counts. To fix wrong readings, they can also open the photos and the reading of an AI read that failed or that you corrected. They do not see the rest of your log.",
  ] },
  { title: "Photos", body: [
    "Every photo is made smaller on your device before it is uploaded. The original never leaves your phone, and the details a camera hides in a photo (such as where it was taken) are removed from the stored copy.",
    "A photo taken with no connection is kept on your device until it has been uploaded.",
  ] },
  { title: "Your choices", body: [
    "Location is optional. Unfuel asks when you add photos, and works without it.",
    "You can export your log as a spreadsheet from More.",
    "You can delete your account from More. Everything listed here is deleted with it: fill-ups, photos, vehicles, stations, settings and usage counts.",
  ] },
];

export default function Privacy() {
  useEffect(() => { document.title = "Privacy · Unfuel"; }, []);
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-3xl items-center px-5 py-5"><Link to="/" aria-label="Unfuel home"><Logo size={28} /></Link></header>
      <main className="mx-auto max-w-3xl px-5 pb-16">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-3 text-muted-foreground">What Unfuel keeps about you, who else handles it, and what you can do about it.</p>
        {sections.map((s) => (
          <section key={s.title} className="mt-8">
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">{s.body.map((b) => <li key={b}>{b}</li>)}</ul>
          </section>
        ))}
      </main>
    </div>
  );
}
