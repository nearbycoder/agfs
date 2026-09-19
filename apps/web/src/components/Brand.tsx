import { Link } from "@tanstack/react-router";
import { FolderTree } from "lucide-react";
export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="AGFS home">
      <span className="brand-mark">
        <FolderTree className="size-5" />
      </span>
      <span>
        agfs<span className="text-primary">.</span>
      </span>
    </Link>
  );
}
