"use client";
import { PullsFeed, useFeed } from "./PullsFeed";

export function LiveFeedPanel() {
  const feed = useFeed();
  return <div className="lp-feed"><PullsFeed feed={feed} /></div>;
}
