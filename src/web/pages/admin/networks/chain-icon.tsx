import { Avatar, AvatarFallback, AvatarImage } from "@/web/components/ui/avatar";

export function ChainIcon({ src, name }: { src: string; name: string }) {
  const initials = name.charAt(0).toUpperCase();

  return (
    <Avatar size="lg" className="shrink-0">
      <AvatarImage src={src} alt={name} />
      <AvatarFallback className="text-sm font-bold">{initials}</AvatarFallback>
    </Avatar>
  );
}
