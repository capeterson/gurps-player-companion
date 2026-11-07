import { Link } from 'react-router-dom';

const SECTIONS = [
  { to: '/admin/users', title: 'Users', description: 'Accounts, suspensions and permissions.' },
  {
    to: '/admin/campaigns',
    title: 'Campaigns',
    description: 'Every campaign, its members and ownership.',
  },
  { to: '/admin/media', title: 'Images', description: 'Uploaded portraits and campaign covers.' },
] as const;

export function AdminHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Admin</h1>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <Link
              to={section.to}
              className="card block h-full border border-base-300 bg-base-100 p-5 transition hover:border-primary"
            >
              <span className="block font-display text-lg font-semibold">{section.title}</span>
              <span className="mt-1 block text-sm text-base-content/70">{section.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
