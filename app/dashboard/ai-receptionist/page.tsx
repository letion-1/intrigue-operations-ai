import { redirect } from 'next/navigation';
// V15.9: Always enter through the existing authenticated dashboard.
export default function ReceptionistPage() {
  redirect('/dashboard?section=ai-receptionist');
}
