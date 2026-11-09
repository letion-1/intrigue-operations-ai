'use client';

import AccountDeletionPanel from '@/app/dashboard/account/AccountDeletionPanel';

// Employee self-service privacy does not expose workspace erasure controls.
// The corresponding API and Supabase RPC independently enforce ownership.
export default function PersonalAccountPrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0b1827] px-4 py-10 text-[#f5f0e8] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-[#d7ae61]">INTRIGUE STUDIOS</p>
            <h1 className="mt-2 text-2xl font-semibold">Personal account &amp; privacy</h1>
            <p className="mt-2 text-sm text-[#b8c7d5]">This page concerns only your own login and personal information.</p>
          </div>
          <a href="/dashboard" className="rounded-xl border border-[#947948] px-4 py-2 text-sm text-[#e9ca8d] hover:bg-[#142539]">Back to workspace</a>
        </div>
        <AccountDeletionPanel scope="personal" />
      </div>
    </main>
  );
}
