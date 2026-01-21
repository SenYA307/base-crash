"use client";

import React, { useState, useEffect, useCallback } from "react";
import AudioControls from "@/components/AudioControls";

interface ReferralInfo {
  code: string;
  stats: {
    totalReferrals: number;
    activatedReferrals: number;
  };
  boost: {
    multiplier: number;
    expiresAt: number;
  } | null;
}

interface AccountViewProps {
  // Auth state
  authToken: string | null;
  authAddress: string | null;
  authFid: string | null;
  isSigningIn: boolean;
  isMiniApp: boolean;
  
  // Wallet state
  isConnected: boolean;
  address: string | undefined;
  isOnBase: boolean;
  isConnecting: boolean;
  
  // Actions
  onConnect: () => void;
  onDisconnect: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSwitchToBase: () => void;
  
  // Optional: compact mode for desktop sidebar
  compact?: boolean;
}

function shortAddress(address?: string | null) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function AccountView({
  authToken,
  authAddress,
  authFid,
  isSigningIn,
  isMiniApp,
  isConnected,
  address,
  isOnBase,
  isConnecting,
  onConnect,
  onDisconnect,
  onSignIn,
  onSignOut,
  onSwitchToBase,
  compact,
}: AccountViewProps) {
  const isAuthed = !!authToken && (!!authAddress || !!authFid);
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Fetch referral info when authed
  useEffect(() => {
    if (!authToken || !isAuthed) {
      setReferralInfo(null);
      return;
    }

    const fetchReferralInfo = async () => {
      try {
        setReferralLoading(true);
        const res = await fetch("/api/referral/me", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setReferralInfo(data);
        }
      } catch {
        // Ignore errors
      } finally {
        setReferralLoading(false);
      }
    };

    fetchReferralInfo();
  }, [authToken, isAuthed]);

  const copyReferralLink = useCallback(() => {
    if (!referralInfo?.code) return;
    const link = `${window.location.origin}/?ref=${referralInfo.code}`;
    navigator.clipboard.writeText(link);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }, [referralInfo?.code]);

  const shareReferralLink = useCallback(async () => {
    if (!referralInfo?.code) return;
    const link = `${window.location.origin}/?ref=${referralInfo.code}`;
    const text = "Join me on Base Crash! 🎮";

    if (navigator.share) {
      try {
        await navigator.share({ title: "Base Crash", text, url: link });
      } catch {
        // User cancelled or share failed
      }
    } else {
      copyReferralLink();
    }
  }, [referralInfo?.code, copyReferralLink]);

  const formatBoostExpiry = (expiresAt: number) => {
    const days = Math.ceil((expiresAt * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
    if (days <= 0) return "Expired";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  };

  return (
    <div className={`flex flex-col gap-4 ${compact ? "" : "p-4"}`}>
      {/* Header */}
      <div className="mb-2">
        <h2 className="text-lg font-bold text-white">Account</h2>
        <p className="text-xs text-white/50">Manage your wallet and sign-in</p>
      </div>

      {/* Auth Status Card */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold text-white/70 mb-3">Sign-in Status</h3>
        
        {isAuthed ? (
          <div className="space-y-3">
            {authFid && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">Farcaster</span>
                <span className="text-sm font-mono text-[#8b5cf6]">FID: {authFid}</span>
              </div>
            )}
            {authAddress && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">Signed as</span>
                <span className="text-sm font-mono text-[#0052ff]">{shortAddress(authAddress)}</span>
              </div>
            )}
            <button
              onClick={onSignOut}
              className="w-full mt-2 py-2 px-4 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/40">Sign in to save scores and access the leaderboard</p>
            <button
              onClick={onSignIn}
              disabled={isSigningIn}
              className="w-full py-3 px-4 rounded-xl bg-[#0052ff] text-white text-sm font-semibold hover:bg-[#0052ff]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSigningIn ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : isMiniApp ? (
                "Sign in (Farcaster)"
              ) : (
                "Sign in with Wallet"
              )}
            </button>
          </div>
        )}
      </div>

      {/* Wallet Connection Card */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold text-white/70 mb-3">Wallet</h3>
        
        {isConnected && address ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Connected</span>
              <span className="text-sm font-mono text-green-400">{shortAddress(address)}</span>
            </div>
            
            {/* Chain status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Network</span>
              {isOnBase ? (
                <span className="text-sm text-green-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  Base
                </span>
              ) : (
                <button
                  onClick={onSwitchToBase}
                  className="text-sm text-yellow-400 hover:text-yellow-300"
                >
                  Switch to Base →
                </button>
              )}
            </div>
            
            <button
              onClick={onDisconnect}
              className="w-full mt-2 py-2 px-4 rounded-xl bg-white/5 text-white/70 text-sm font-medium hover:bg-white/10 transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/40">Connect wallet to buy hints with USDC</p>
            <button
              onClick={onConnect}
              disabled={isConnecting}
              className="w-full py-3 px-4 rounded-xl border border-[#0052ff]/50 bg-[#0052ff]/10 text-[#6fa8ff] text-sm font-semibold hover:bg-[#0052ff]/20 transition-colors disabled:opacity-50"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          </div>
        )}
      </div>

      {/* Referral Section - Only show when authed */}
      {isAuthed && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold text-white/70 mb-3">🎁 Invite Friends</h3>
          
          {referralLoading ? (
            <div className="flex items-center justify-center py-4">
              <span className="w-5 h-5 border-2 border-white/20 border-t-[#0052ff] rounded-full animate-spin" />
            </div>
          ) : referralInfo ? (
            <div className="space-y-3">
              {/* Referral Link */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${referralInfo.code}`}
                  className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono text-white/80 truncate"
                />
                <button
                  onClick={copyReferralLink}
                  className="px-3 py-2 rounded-lg bg-[#0052ff]/20 text-[#6fa8ff] text-xs font-medium hover:bg-[#0052ff]/30 transition-colors"
                >
                  {copySuccess ? "✓" : "Copy"}
                </button>
              </div>

              {/* Share Button */}
              <button
                onClick={shareReferralLink}
                className="w-full py-2 px-4 rounded-xl bg-[#0052ff] text-white text-sm font-semibold hover:bg-[#0052ff]/90 transition-colors"
              >
                Share Invite Link
              </button>

              {/* Stats */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="text-xs text-white/50">Invites</span>
                <span className="text-xs text-white">
                  {referralInfo.stats.activatedReferrals} / {referralInfo.stats.totalReferrals} active
                </span>
              </div>

              {/* Boost Status */}
              {referralInfo.boost && referralInfo.boost.multiplier > 1 && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#ff6b00]/10 border border-[#ff6b00]/30">
                  <span className="text-xs text-[#ffb366]">
                    🔥 Boost: +{Math.round((referralInfo.boost.multiplier - 1) * 100)}%
                  </span>
                  <span className="text-xs text-[#ffb366]/70">
                    {formatBoostExpiry(referralInfo.boost.expiresAt)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/40">Unable to load referral info</p>
          )}
        </div>
      )}

      {/* Audio Controls */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold text-white/70 mb-3">Sound</h3>
        <AudioControls />
      </div>

      {/* Credits */}
      <div className="mt-auto pt-4 text-center">
        <p className="text-xs text-white/30">
          Base Crash • Built on Base
        </p>
      </div>
    </div>
  );
}
