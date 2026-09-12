export type ReadinessCheck = {
  id: string;
  label: string;
  ready: boolean;
  required: boolean;
  owner: "engineering" | "operations" | "legal" | "supplier";
};

function present(value: string | undefined) {
  return Boolean(value && value.trim() && !/replace_me|replace_with/i.test(value));
}

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

type ReadinessEnvironment = Readonly<Record<string, string | undefined>>;

export function paidReadinessChecks(env: ReadinessEnvironment = process.env): ReadinessCheck[] {
  const firebaseWebReady = [
    env.NEXT_PUBLIC_FIREBASE_API_KEY,
    env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    env.NEXT_PUBLIC_FIREBASE_APP_ID,
  ].every(present);
  const provider = env.FULFILLMENT_PROVIDER?.trim().toLowerCase();
  const providerPackages = ["LAUNCH", "AUTHORITY", "AUTHORITY_PLUS"];
  const providerReady = provider === "prnow"
    && present(env.PRNOW_API_KEY)
    && env.PRNOW_SUBMIT_ENABLED === "true"
    && providerPackages.every((suffix) => {
      const cost = Number(env[`PRNOW_COST_CENTS_${suffix}`]);
      const credits = Number(env[`PRNOW_REQUIRED_CREDITS_${suffix}`]);
      return present(env[`PRNOW_PLAN_${suffix}`]) && Number.isSafeInteger(cost) && cost > 0 && Number.isSafeInteger(credits) && credits > 0;
    });
  return [
    { id: "firebase_web", label: "Firebase Web authentication is configured", ready: firebaseWebReady, required: true, owner: "engineering" },
    { id: "firebase_admin", label: "Firebase Admin is configured for server-owned records", ready: present(env.FIREBASE_SERVICE_ACCOUNT_JSON) || present(env.GOOGLE_APPLICATION_CREDENTIALS) || present(env.K_SERVICE), required: true, owner: "engineering" },
    { id: "firestore_rules", label: "Current Firestore rules were deployed and live-tested", ready: enabled(env.FIRESTORE_RULES_VERIFIED), required: true, owner: "engineering" },
    { id: "firestore_indexes", label: "Worker and billing collection-group indexes were deployed and tested", ready: enabled(env.FIRESTORE_INDEXES_VERIFIED), required: true, owner: "engineering" },
    { id: "openai", label: "Campaign generation model credentials are configured", ready: present(env.OPENAI_API_KEY) && present(env.OPENAI_MODEL), required: true, owner: "engineering" },
    { id: "provider_adapter", label: "The guarded PRNow pilot adapter, key, plan, and exact cost are configured", ready: providerReady, required: true, owner: "supplier" },
    { id: "provider_contract", label: "Provider contract and outcome language are approved", ready: enabled(env.FULFILLMENT_PROVIDER_CONTRACT_APPROVED), required: true, owner: "supplier" },
    { id: "provider_costs", label: "Provider costs and package margins are verified", ready: enabled(env.FULFILLMENT_PROVIDER_COSTS_VERIFIED), required: true, owner: "operations" },
    { id: "stripe", label: "Stripe secret, webhook, and all package prices are configured", ready: [env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, env.STRIPE_PRICE_LAUNCH, env.STRIPE_PRICE_AUTHORITY, env.STRIPE_PRICE_AUTHORITY_PLUS].every(present), required: true, owner: "engineering" },
    { id: "production_url", label: "The production HTTPS application URL is configured", ready: Boolean(env.NEXT_PUBLIC_APP_URL?.startsWith("https://")), required: true, owner: "engineering" },
    { id: "job_runner", label: "The job runner has a strong secret and its production schedule was verified", ready: present(env.JOB_RUNNER_SECRET) && (env.JOB_RUNNER_SECRET?.length ?? 0) >= 32 && enabled(env.JOB_SCHEDULER_VERIFIED), required: true, owner: "engineering" },
    { id: "admin", label: "At least one internal administrator is configured", ready: present(env.ADMIN_USER_IDS), required: true, owner: "operations" },
    { id: "email", label: "Transactional customer email is configured", ready: present(env.RESEND_API_KEY) && present(env.EMAIL_FROM), required: true, owner: "operations" },
    { id: "error_monitoring", label: "Production error monitoring is connected", ready: present(env.ERROR_REPORTING_DSN), required: true, owner: "engineering" },
    { id: "backups", label: "Firestore backup and restore policy is confirmed", ready: enabled(env.FIRESTORE_BACKUP_POLICY_CONFIRMED), required: true, owner: "operations" },
    { id: "legal", label: "Privacy, terms, refund, supplier, and claims language are approved", ready: enabled(env.LEGAL_DOCUMENTS_APPROVED), required: true, owner: "legal" },
    { id: "beta", label: "Controlled beta customer list and support owner are confirmed", ready: enabled(env.CONTROLLED_BETA_READY), required: true, owner: "operations" },
  ];
}

export function paidReadiness(env: ReadinessEnvironment = process.env) {
  const checks = paidReadinessChecks(env);
  const required = checks.filter((check) => check.required);
  const readyCount = required.filter((check) => check.ready).length;
  return {
    readyForPaidUsers: readyCount === required.length,
    readyCount,
    requiredCount: required.length,
    checks,
  };
}

export function assertCheckoutReadiness(livemode: boolean, env: ReadinessEnvironment = process.env) {
  if (livemode && !paidReadiness(env).readyForPaidUsers) {
    throw new Error("Live checkout is disabled until the production launch checklist is complete.");
  }
}
