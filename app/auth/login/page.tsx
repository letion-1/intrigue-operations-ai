import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex justify-center"><img src="/intrigue-mark.png" alt="INTRIGUE emblem" className="h-20 w-20 object-contain" /></div>
        <LoginForm />
      </div>
    </div>
  );
}
