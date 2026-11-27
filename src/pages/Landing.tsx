import { useAuthActions } from "@convex-dev/auth/react";
import { m } from "framer-motion";
import { ArrowRight, BarChart3, Camera, CloudOff, Gauge, MapPin, ScanLine, Smartphone, TrendingDown, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/shell/Logo";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/format";

declare global {
  interface Window {
    /** Test-only sign-in hook, set in dev and VITE_E2E_AUTH builds. */
    __e2eSignIn?: (params: Record<string, string>) => Promise<void>;
  }
}

const features = [
  { icon: Camera, title: "Two photos, done", body: "Photograph the fuel bill and the odometer. Unfuel reads the amount, the litres, the date and the reading for you." },
  { icon: Gauge, title: "Your real mileage", body: "Exact between full tanks, and a fair estimate if you fill by amount. From your second fill-up on." },
  { icon: Wallet, title: "Cost per kilometre", body: "What every kilometre costs you, what you spend a month, and how the price of fuel is moving." },
  { icon: TrendingDown, title: "Knows when it dips", body: "A drop in mileage is flagged with the date it began, so you can check tyres, filter or service before it costs more." },
  { icon: MapPin, title: "Remembers the station", body: "Each fill-up is tied to the real fuel station. See which one gives you better mileage and a better price." },
  { icon: CloudOff, title: "Works with no signal", body: "Take the photos at the pump with no network. They are kept on your phone and read as soon as you are back online." },
  { icon: BarChart3, title: "Charts that mean something", body: "Mileage, cost, price, spend and distance over time, for each vehicle you own." },
  { icon: Smartphone, title: "Installs like an app", body: "Add it to your home screen on Android or iPhone. Opens full screen, starts fast, nothing to download from a store." },
  { icon: ScanLine, title: "Typing always works", body: "Every field can be typed or corrected by hand. Your log is yours: export it as a spreadsheet any time." },
];

const steps = [
  { n: "1", title: "Sign in", body: "With your Google account. No forms, no vehicle setup first." },
  { n: "2", title: "Add two photos", body: "The bill (or the pump's display) and the odometer, in any order." },
  { n: "3", title: "Read the numbers", body: "From the second fill-up: your mileage and what each kilometre costs." },
];

function useGoogle() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The e2e suite cannot drive Google's sign-in, so it calls this instead; it reaches the Password
  // provider in convex/auth.ts, which exists only on a local deployment with E2E_AUTH=1. Production
  // builds compile this out.
  useEffect(() => {
    if (!import.meta.env.DEV && !import.meta.env.VITE_E2E_AUTH) return;
    window.__e2eSignIn = (params) => signIn("password", params).then(() => undefined);
  }, [signIn]);
  const go = () => {
    setBusy(true);
    setError(null);
    signIn("google", { redirectTo: "/" }).catch((e) => { setError(errorText(e)); setBusy(false); });
  };
  return { go, busy, error };
}

export default function Landing() {
  const { go, busy, error } = useGoogle();
  useEffect(() => { document.title = "Unfuel: know what your vehicle really costs to run"; }, []);
  const cta = (label: string) => (
    <Button size="lg" className="h-11 px-5 text-base" onClick={go} disabled={busy}>{busy ? "Opening Google…" : label} <ArrowRight /></Button>
  );
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5">
        <Logo size={28} />
        <Button variant="outline" onClick={go} disabled={busy}>Sign in</Button>
      </header>
      <main className="mx-auto max-w-5xl px-5">
        <section className="py-12 sm:py-20">
          <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Know what your vehicle really costs to run.</h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Photograph the fuel bill and the odometer. Unfuel works out your mileage, your cost per kilometre and where the money goes. Free, no ads.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">{cta("Continue with Google")}</div>
            {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
          </m.div>
          {/* what the home screen shows after a second fill-up */}
          <m.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }} className="mt-12 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3" aria-label="An example of what Unfuel shows">
            {[["Mileage", "43.5 km/l", "last five fill-ups"], ["Cost per km", "₹2.44", "at ₹106 a litre"], ["This month", "₹3,200", "three fill-ups"]].map(([label, value, sub]) => (
              <div key={label} className="rounded-xl bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-semibold tabular tracking-tight">{value}</div>
                <div className="text-xs text-muted-foreground">{sub}</div>
              </div>
            ))}
          </m.div>
        </section>

        <section aria-labelledby="how" className="border-t py-12">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{s.n}</span>
                <div className="min-w-0">
                  <div className="font-medium">{s.title}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="features" className="border-t py-12">
          <h2 id="features" className="text-2xl font-semibold tracking-tight">What you get</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <m.div key={f.title} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 3) * 0.05 }} className="min-w-0 rounded-xl bg-card p-5 shadow-card">
                <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-secondary"><f.icon className="size-4.5" /></div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
              </m.div>
            ))}
          </div>
        </section>

        <section className="border-t py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Your next fill-up is the first entry.</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">It takes two photos and about a minute.</p>
          <div className="mt-6 flex justify-center">{cta("Start with Google")}</div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-10 text-xs text-muted-foreground">
        <span>Unfuel is free. Your data is yours: export it or delete it any time.</span>
        <Link to="/privacy" className="hover:underline">Privacy</Link>
      </footer>
    </div>
  );
}
