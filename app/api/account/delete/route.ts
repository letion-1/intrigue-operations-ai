import {NextResponse} from 'next/server';

// RC2 retires the legacy endpoint which lacked recent sign-in checks.
const retired=()=>NextResponse.json(
  {error:'This endpoint is retired. Use Settings > Privacy, ownership & account deletion.'},
  {status:410,headers:{'Cache-Control':'private, no-store'}}
);
export const GET=retired;
export const POST=retired;
