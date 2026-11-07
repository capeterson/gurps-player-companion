export function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <p className="label-eyebrow">About</p>
        <h1 className="font-display text-3xl">Sunbolt</h1>
        <p className="max-w-2xl text-sm text-muted">
          A <strong>GURPS 4th edition</strong> companion.
        </p>
      </header>

      <section className="card gap-4 p-card">
        <h2 className="font-display text-2xl">Legal</h2>
        <p className="text-sm leading-relaxed">
          GURPS is a trademark of Steve Jackson Games, and its rules and art are copyrighted by
          Steve Jackson Games. All rights are reserved by Steve Jackson Games. This game aid is the
          original creation and is released for free distribution, and not for resale, under the
          permissions granted in the{' '}
          <a
            href="http://www.sjgames.com/general/online_policy.html"
            className="link link-primary [overflow-wrap:anywhere]"
            target="_blank"
            rel="noopener noreferrer"
          >
            Steve Jackson Games Online Policy
          </a>
          .
        </p>
      </section>

      <section className="card gap-4 p-card">
        <h2 className="font-display text-2xl">Source</h2>
        <p className="text-sm leading-relaxed">
          This application is open-source, with the original source code on github at{' '}
          <a
            href="https://github.com/capeterson/gurps-player-companion/"
            className="link link-primary [overflow-wrap:anywhere]"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://github.com/capeterson/gurps-player-companion/
          </a>
          . It's a hobby project with very limited support. This app has been developed with
          extensive AI assistance.
        </p>
      </section>
    </div>
  );
}
