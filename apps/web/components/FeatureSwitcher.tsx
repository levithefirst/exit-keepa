/**
 * CSS-only tab switcher — three sr-only radios inside their own labels,
 * one shared `group` ancestor, active pill + visible panel both driven
 * by `group-has-[#id:checked]` keyed to each radio's unique id. No
 * JavaScript, no peer-ordering constraints.
 */

const FEATURES = [
  {
    id: "feature-exit",
    // Tailwind's class scanner only picks up complete, literal class
    // strings - it can't see a name built with `${f.id}` at runtime, so
    // each variant is written out in full here rather than interpolated.
    pillActive: "group-has-[#feature-exit:checked]:bg-mint-400 group-has-[#feature-exit:checked]:text-forest-950",
    panelVisible: "hidden group-has-[#feature-exit:checked]:grid",
    tab: "Set your exit",
    heading: "Set your exit",
    body: "Define the rate condition that should trigger a withdrawal — once. No dashboard to babysit.",
    bullets: [
      "Pick the market (Aave v3 USDC on Base in v1) and the exact rate condition — e.g. supply APR below 2%.",
      "Choose the amount: your entire position, or an exact smallest-unit amount.",
      "The transaction is rebuilt deterministically from your strategy every time — never from anything typed at trigger time.",
    ],
    media: (
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cream-400">Trigger condition</p>
        <p className="font-mono text-sm text-mint-300">supply_apr &lt; 200 bps</p>
        <div className="h-px bg-cream-100/10" />
        <p className="text-xs font-medium uppercase tracking-wide text-cream-400">Action</p>
        <p className="text-sm text-cream-200">Withdraw USDC from Aave → back to your Safe</p>
      </div>
    ),
  },
  {
    id: "feature-simulate",
    pillActive: "group-has-[#feature-simulate:checked]:bg-mint-400 group-has-[#feature-simulate:checked]:text-forest-950",
    panelVisible: "hidden group-has-[#feature-simulate:checked]:grid",
    tab: "Simulate first",
    heading: "Simulate before execution",
    body: "Every strategy can be checked against the real chain before anything moves — a genuine dry run, not a mock.",
    bullets: [
      "Runs the exact call through KeeperHub with simulate: true — the real Roles Modifier, the real Aave Pool.",
      "Shows whether it would succeed, or the exact revert reason if it wouldn't.",
      "Broadcasting is only ever enabled after a simulation just came back clean.",
    ],
    media: (
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cream-400">Simulation result</p>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-mint-400" />
          <span className="text-sm text-mint-300">wouldRevert: false</span>
        </div>
        <p className="text-pretty text-xs text-cream-400">
          Simulated only — nothing has been broadcast to the chain yet.
        </p>
      </div>
    ),
  },
  {
    id: "feature-execute",
    pillActive: "group-has-[#feature-execute:checked]:bg-mint-400 group-has-[#feature-execute:checked]:text-forest-950",
    panelVisible: "hidden group-has-[#feature-execute:checked]:grid",
    tab: "Protected execution",
    heading: "Protected onchain execution",
    body: "Execution never touches your keys. It's routed through KeeperHub and constrained by a Zodiac Roles permission before it ever reaches your Safe.",
    bullets: [
      "KeeperHub calls execTransactionWithRole — it can never call anything else.",
      "Your Safe's Roles Modifier only permits what's explicitly scoped to that role — nothing by default.",
      "Funds can only land back in the Safe that owns them, never anywhere else.",
    ],
    media: (
      <div className="flex flex-col gap-1.5 font-mono text-xs text-cream-300">
        <span>KeeperHub</span>
        <span className="text-cream-500">↓ execTransactionWithRole</span>
        <span>Zodiac Roles Modifier</span>
        <span className="text-cream-500">↓ scoped permission check</span>
        <span>Your Safe</span>
        <span className="text-cream-500">↓ withdraw(asset, amount, to)</span>
        <span className="text-mint-300">Aave v3 Pool</span>
      </div>
    ),
  },
];

export function FeatureSwitcher() {
  return (
    <div className="group">
      <fieldset>
        <legend className="sr-only">Choose a feature to learn about</legend>
        <div role="tablist" className="mx-auto mb-8 flex w-fit flex-wrap justify-center gap-1 rounded-full border border-cream-100/15 bg-forest-800/60 p-1">
          {FEATURES.map((f, i) => (
            <label
              key={f.id}
              htmlFor={f.id}
              role="tab"
              className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-cream-300 transition-colors hover:text-cream-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-mint-400/70 ${f.pillActive}`}
            >
              <input type="radio" id={f.id} name="feature" defaultChecked={i === 0} className="sr-only" />
              {f.tab}
            </label>
          ))}
        </div>
      </fieldset>

      {FEATURES.map((f) => (
        <div key={f.id} className={`${f.panelVisible} gap-8 sm:grid-cols-2 sm:items-center`}>
          <div>
            <h3 className="text-balance mb-2 font-display text-2xl font-bold text-cream-50">{f.heading}</h3>
            <p className="text-pretty mb-4 text-cream-300">{f.body}</p>
            <ul className="space-y-2">
              {f.bullets.map((b) => (
                <li key={b} className="flex gap-2 text-sm text-cream-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mint-400" />
                  <span className="text-pretty">{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-6">{f.media}</div>
        </div>
      ))}
    </div>
  );
}
