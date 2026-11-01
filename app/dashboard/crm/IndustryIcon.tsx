"use client";

import { Building2, BriefcaseBusiness, CarFront, HeartPulse, Hotel, Laptop2, ShoppingBag, Truck, UtensilsCrossed } from "lucide-react";

export function isAutomotiveIndustry(industry: string | null | undefined) {
  return /automot|vehicle|repair|garage|auto shop/i.test(industry ?? "");
}

export default function IndustryIcon({ industry, size = 19 }: { industry?: string | null; size?: number }) {
  const value = (industry ?? "").toLowerCase();
  if (isAutomotiveIndustry(value)) return <CarFront size={size} aria-label="Automotive business" />;
  if (/retail|fashion|e-commerce|ecommerce|commerce|shop/i.test(value)) return <ShoppingBag size={size} aria-label="Retail business" />;
  if (/real estate|property|housing/i.test(value)) return <Building2 size={size} aria-label="Real estate business" />;
  if (/hospitality|hotel|accommodation/i.test(value)) return <Hotel size={size} aria-label="Hospitality business" />;
  if (/restaurant|food|catering/i.test(value)) return <UtensilsCrossed size={size} aria-label="Food business" />;
  if (/health|medical|clinic/i.test(value)) return <HeartPulse size={size} aria-label="Healthcare business" />;
  if (/tech|software|it\b/i.test(value)) return <Laptop2 size={size} aria-label="Technology business" />;
  if (/logistic|delivery|transport/i.test(value)) return <Truck size={size} aria-label="Logistics business" />;
  return <BriefcaseBusiness size={size} aria-label="Business" />;
}
