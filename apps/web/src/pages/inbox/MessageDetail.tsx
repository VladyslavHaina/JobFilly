import {
  CATEGORIES,
  type Category,
  type JobFacts,
  MessageBodySchema,
  type MessageDetail,
  MessageDetailSchema,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Link } from "react-router";
import { ApiError, api } from "../../api";
import { Alert, Button, Card, Loading, SelectField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths, paths } from "../../paths";
import { CvChoice } from "../cvs";
import { DraftPanel } from "../drafts";
import { MatchPanel } from "../match";
import { RoleProfile } from "../profile/RoleProfile";
import { SenderPanel } from "../senders";
import { CategoryChip, CouldNotAnalyze, couldNotAnalyze } from "./badges";
import {
  CATEGORY_LABELS,
  formatAgency,
  formatFullDate,
  formatPay,
  formatPlace,
  formatTimeZones,
  formatWorkMode,
  NOT_STATED,
  safeLink,
} from "./format";

// One message of the job inbox, opened on its deep link: its job facts (one block per role), the
// category correction for editors, and the body as plain text, fetched from the mailbox when the
// message opens and never rendered as HTML.

const detailKey = (workspaceId: string, messageId: string) =>
  [...queryKeys.area(workspaceId, "messages"), "detail", messageId] as const;

/**
 * The body is kept out of the "messages" area on purpose: live updates during a scan refetch
 * that area often, and each body fetch is a round trip to the mailbox.
 */
const bodyKey = (workspaceId: string, messageId: string) =>
  ["w", workspaceId, "body", messageId] as const;

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "That didn't work. Try again.";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 py-1.5">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className={`text-sm ${empty ? "text-stone-400 italic" : "text-stone-900"}`}>
        {empty ? NOT_STATED : children}
      </dd>
    </div>
  );
}

const joined = (items: readonly string[]) => (items.length > 0 ? items.join(", ") : null);

function Pay({ pay }: { pay: NonNullable<JobFacts["pay"]> }) {
  const normalised = formatPay(pay);
  return (
    <>
      {normalised && <span className="block">{normalised}</span>}
      <span className={normalised ? "block text-xs text-stone-500" : "block"}>
        As written: “{pay.asWritten}”
      </span>
    </>
  );
}

function ApplyLink({ url }: { url: string }) {
  const href = safeLink(url);
  if (!href) return <span className="break-all">{url}</span>;
  return (
    <a
      className="break-all text-indigo-700 hover:underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {url}
    </a>
  );
}

function RoleFacts({ role, heading }: { role: JobFacts; heading: string }) {
  const agency = role.agency ? formatAgency(role.agency) : null;
  return (
    <section aria-label={heading} className="rounded-md border border-stone-200 px-4 py-3">
      <h3 className="text-sm font-semibold text-stone-900">{role.title ?? heading}</h3>
      <dl className="mt-1 divide-y divide-stone-100">
        <Fact label="Title">{role.title}</Fact>
        <Fact label="Company">{role.company}</Fact>
        <Fact label="Agency">{agency}</Fact>
        <Fact label="Places">{joined(role.places.map(formatPlace).filter(Boolean))}</Fact>
        <Fact label="Work mode">{role.workMode ? formatWorkMode(role.workMode) : null}</Fact>
        <Fact label="Remote scope">{role.remoteScope}</Fact>
        <Fact label="Time zones">{role.timeZones ? formatTimeZones(role.timeZones) : null}</Fact>
        <Fact label="Pay">{role.pay ? <Pay pay={role.pay} /> : null}</Fact>
        <Fact label="Contract">{role.contract}</Fact>
        <Fact label="Seniority">{role.seniority}</Fact>
        <Fact label="Work permit">{role.workPermit}</Fact>
        <Fact label="Skills">{joined(role.skills)}</Fact>
        <Fact label="Languages">{joined(role.languages)}</Fact>
        <Fact label="Apply">{role.applyUrl ? <ApplyLink url={role.applyUrl} /> : null}</Fact>
        {Object.entries(role.extra).map(([key, value]) => (
          <Fact key={key} label={key}>
            {value}
          </Fact>
        ))}
      </dl>
    </section>
  );
}

function CategoryCorrection(props: {
  message: MessageDetail;
  box: RefObject<HTMLDivElement | null>;
}) {
  const { message } = props;
  const { workspaceId, can } = useWorkspace();
  const client = useQueryClient();
  const correct = useMutation({
    mutationFn: (category: Category) =>
      api(`${apiPaths.message(workspaceId, message.id)}/category`, MessageDetailSchema, {
        method: "PUT",
        body: { category },
      }),
    onSuccess: (updated) => {
      client.setQueryData(detailKey(workspaceId, message.id), updated);
      void client.invalidateQueries({
        queryKey: [...queryKeys.area(workspaceId, "messages"), "list"],
      });
    },
  });
  let hint: string;
  if (!can.edit) hint = "Only editors and admins can correct the category.";
  else if (message.categorySource === "you") hint = "Corrected by hand: later analysis keeps it.";
  else hint = "Wrong? Pick the right one; later analysis keeps your choice.";
  return (
    <div ref={props.box} className="max-w-xs">
      <SelectField
        label="Category"
        value={message.category ?? ""}
        disabled={!can.edit || correct.isPending}
        hint={hint}
        error={correct.error ? errorText(correct.error) : null}
        onChange={(e) => correct.mutate(e.target.value as Category)}
      >
        {message.category === null && (
          <option value="" disabled>
            Not set
          </option>
        )}
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function Body({ workspaceId, messageId }: { workspaceId: string; messageId: string }) {
  const body = useQuery({
    queryKey: bodyKey(workspaceId, messageId),
    queryFn: () => api(`${apiPaths.message(workspaceId, messageId)}/body`, MessageBodySchema),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (body.isPending) return <Loading label="Fetching the message from your mailbox…" />;
  if (body.isError) return <Alert>{errorText(body.error)}</Alert>;
  if ("gone" in body.data) {
    return (
      <Alert tone="info">This message is no longer in the mailbox, so it can't be shown.</Alert>
    );
  }
  // Plain text only: React writes it as a text node, so markup in the mail is shown, not run.
  return (
    <pre
      data-testid="message-body"
      className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-stone-800"
    >
      {body.data.text}
    </pre>
  );
}

function Status(props: { message: MessageDetail; onSetCategory: () => void }) {
  const { message } = props;
  const { can } = useWorkspace();
  if (message.ownReply) {
    return (
      <Alert tone="info" title="Your reply">
        You sent this. Your replies aren't listed in the job inbox; the intake form reads them for
        what you said you want.
      </Alert>
    );
  }
  if (couldNotAnalyze(message)) {
    return (
      <Alert tone="warning" title="Couldn't analyze">
        <p>
          The AI's answer for this email didn't fit, so nothing was guessed.{" "}
          {can.edit
            ? "Read it below and set the category if you know it."
            : "Read it below; an editor or admin can set its category."}
        </p>
        {/* Nothing analyzes a failed message again: setting the category is the way on. */}
        {can.edit && (
          <Button variant="secondary" className="mt-2" onClick={props.onSetCategory}>
            Set the category
          </Button>
        )}
      </Alert>
    );
  }
  if (message.analysisStatus === "pending" && message.category !== "not_job") {
    return <Alert tone="info">Not analyzed yet.</Alert>;
  }
  return null;
}

/** Each role's facts, with its profile, CV choice, match and draft (the slices' slots). */
function Facts({ workspaceId, message }: { workspaceId: string; message: MessageDetail }) {
  const { can } = useWorkspace();
  if (message.ownReply || message.category === "not_job") return null;
  if (message.roles.length === 0) {
    if (message.analysisStatus !== "done") return null;
    return <p className="text-sm text-stone-500">No job facts found in this email.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-stone-700">
        {message.roles.length === 1 ? "Job facts" : `${message.roles.length} roles`}
      </h3>
      {message.roles.map((role, i) => (
        // Roles have no id of their own; their order is fixed by the extraction.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={i} className="flex flex-col gap-2">
          <RoleFacts role={role} heading={`Role ${i + 1}`} />
          <RoleProfile
            workspaceId={workspaceId}
            messageId={message.id}
            position={i}
            profile={role.profile ?? null}
          />
          <MatchPanel
            workspaceId={workspaceId}
            messageId={message.id}
            position={i}
            evaluation={role.evaluation}
          />
          <CvChoice
            workspaceId={workspaceId}
            messageId={message.id}
            position={i}
            choice={role.cvChoice}
          />
          {can.mail && <DraftPanel workspaceId={workspaceId} messageId={message.id} position={i} />}
        </div>
      ))}
    </div>
  );
}

export function MessageDetailView(props: { workspaceId: string; messageId: string }) {
  const { workspaceId, messageId } = props;
  const { can } = useWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  const correction = useRef<HTMLDivElement>(null);
  const detail = useQuery({
    queryKey: detailKey(workspaceId, messageId),
    queryFn: () => api(apiPaths.message(workspaceId, messageId), MessageDetailSchema),
    retry: false,
  });
  const loadedId = detail.data?.id;
  // Keyboard and screen-reader users land in the message they opened.
  useEffect(() => {
    if (loadedId) heading.current?.focus();
  }, [loadedId]);

  const close = (
    <Link
      to={paths.inbox(workspaceId)}
      className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
    >
      Close <kbd className="ml-1 text-xs text-stone-400">Esc</kbd>
    </Link>
  );

  if (detail.isPending) {
    return (
      <Card>
        <Loading />
      </Card>
    );
  }
  if (detail.isError) {
    const gone = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <Card>
        <div className="flex items-start justify-between gap-3">
          <Alert>{gone ? "This message isn't in this workspace." : errorText(detail.error)}</Alert>
          {close}
        </div>
      </Card>
    );
  }
  const message = detail.data;
  return (
    <Card className="flex min-w-0 flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold break-words text-stone-900 focus:outline-none"
          >
            {message.subject || "(no subject)"}
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            {message.from.name
              ? `${message.from.name} <${message.from.address}>`
              : message.from.address}
          </p>
          <p className="text-xs text-stone-500">
            <time dateTime={message.date}>{formatFullDate(message.date)}</time>
            {message.mailbox && <> · in {message.mailbox.address}</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.category && <CategoryChip category={message.category} />}
            {couldNotAnalyze(message) && <CouldNotAnalyze />}
          </div>
        </div>
        {close}
      </header>
      <Status
        message={message}
        onSetCategory={() => correction.current?.querySelector("select")?.focus()}
      />
      {!message.ownReply && (
        <SenderPanel
          workspaceId={workspaceId}
          messageId={message.id}
          from={message.from}
          check={message.senderCheck}
          category={message.category}
          analysisStatus={message.analysisStatus}
        />
      )}
      {!message.ownReply && <CategoryCorrection message={message} box={correction} />}
      <Facts workspaceId={workspaceId} message={message} />
      <section aria-label="Message" className="border-t border-stone-200 pt-4">
        {can.mail ? (
          <Body workspaceId={workspaceId} messageId={messageId} />
        ) : (
          // MVP 3 (F6.1): the job pipeline only, no message text.
          <p className="text-sm text-stone-500">
            The message's text isn't shown: you see this workspace's job pipeline only.
          </p>
        )}
      </section>
    </Card>
  );
}
