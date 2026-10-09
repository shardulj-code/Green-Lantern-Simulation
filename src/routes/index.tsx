import { createFileRoute } from "@tanstack/react-router";
import { LanternGame } from "@/components/lantern/lantern-game";

export const Route = createFileRoute("/")({ component: LanternGame });
