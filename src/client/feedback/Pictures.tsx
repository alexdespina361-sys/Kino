import { useRef } from "react";
import { FEEDBACK_LIMITS } from "../../shared";
import { useT } from "../i18n";
import { CameraIcon, CloseIcon, ImageIcon, PaperclipIcon, PencilIcon, ScreenshotIcon } from "../shared/icons";
import type { Piece } from "./images";
import { Section } from "./ui";

export type AddRole = "screenshot" | "photo" | "file";

export interface PicturesProps {
  pieces: Piece[];
  /** Pictures can be added here at all (not on a TV that has only a remote to walk it with). */
  available: boolean;
  /** A phone or a tablet has a camera to take a photo with. */
  camera: boolean;
  /** A computer: a screenshot is pasted, or dropped on the form. */
  paste: boolean;
  busy: boolean;
  problem: string | null;
  onCapture: () => void;
  onFiles: (files: File[], role: AddRole) => void;
  onMark: (id: string) => void;
  onRemove: (id: string) => void;
  onNote: (id: string, note: string) => void;
}

const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** "Show us": the screen as it is, a picture, a photo of the TV, a file, and the marks that point at the trouble. */
export function Pictures(props: PicturesProps) {
  const t = useT();
  const picture = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const take = (role: AddRole) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = ""; // (the same file can be chosen again)
    if (files.length > 0) props.onFiles(files, role);
  };
  const full = props.pieces.length >= FEEDBACK_LIMITS.attachments;

  return (
    <Section title={t("feedback.show")} hint={props.available ? t("feedback.showHint") : undefined} testId="fb-show">
      {props.available ? (
        <>
          <div className="fb-adds">
            <button type="button" className="fb-add" data-nav data-testid="fb-capture" disabled={props.busy || full} onClick={props.onCapture}>
              <ScreenshotIcon />
              <span>{t("feedback.capture")}</span>
            </button>
            <button type="button" className="fb-add" data-nav data-testid="fb-add-picture" disabled={props.busy || full} onClick={() => picture.current?.click()}>
              <ImageIcon />
              <span>{t("feedback.addPicture")}</span>
            </button>
            {props.camera ? (
              <button type="button" className="fb-add" data-nav data-testid="fb-add-photo" disabled={props.busy || full} onClick={() => photo.current?.click()}>
                <CameraIcon />
                <span>{t("feedback.addPhoto")}</span>
              </button>
            ) : null}
            <button type="button" className="fb-add" data-nav data-testid="fb-add-file" disabled={props.busy || full} onClick={() => file.current?.click()}>
              <PaperclipIcon />
              <span>{t("feedback.addFile")}</span>
            </button>
            <input ref={picture} type="file" accept="image/*" multiple hidden data-testid="fb-input-picture" onChange={take("screenshot")} />
            <input ref={photo} type="file" accept="image/*" capture="environment" hidden data-testid="fb-input-photo" onChange={take("photo")} />
            <input ref={file} type="file" accept=".txt,.log,.json,.md,.csv,.srt,.vtt,text/plain,application/json" multiple hidden data-testid="fb-input-file" onChange={take("file")} />
          </div>
          <p className="fb-hint">{props.paste ? t("feedback.pasteHint") : t("feedback.screenshotHint")}</p>
        </>
      ) : (
        <p className="fb-note" data-testid="fb-no-pictures">
          {t("feedback.noPictures")}
        </p>
      )}
      {props.busy ? (
        <p className="fb-working" role="status">
          <span className="spinner" /> {t("feedback.pictureWorking")}
        </p>
      ) : null}
      {props.problem ? (
        <p className="fb-problem" role="alert" data-testid="fb-pictures-problem">
          {props.problem}
        </p>
      ) : null}
      {props.pieces.length > 0 ? (
        <ul className="fb-pieces" data-testid="fb-pieces">
          {props.pieces.map((piece) => (
            <li key={piece.id} className="fb-piece" data-testid="fb-piece">
              {piece.role === "file" ? (
                <span className="fb-file-icon" aria-hidden="true">
                  <PaperclipIcon />
                </span>
              ) : (
                <img className="fb-thumb" src={piece.markedUrl ?? piece.url} alt={t("feedback.pictureAlt", { name: piece.name })} />
              )}
              <div className="fb-piece-main">
                <strong className="fb-piece-name">{piece.name}</strong>
                <small>
                  {piece.role === "file" ? t("feedback.role.file") : piece.role === "photo" ? t("feedback.role.photo") : t("feedback.role.screenshot")}
                  {" · "}
                  {size((piece.marked ?? piece).blob.size)}
                  {piece.shapes.length > 0 ? ` · ${t("feedback.marked", { count: piece.shapes.length })}` : ""}
                </small>
                <input
                  className="fb-piece-note"
                  type="text"
                  maxLength={FEEDBACK_LIMITS.note}
                  value={piece.note}
                  placeholder={t("feedback.pieceNote")}
                  aria-label={t("feedback.pieceNoteLabel", { name: piece.name })}
                  data-nav
                  data-testid="fb-piece-note"
                  onChange={(event) => props.onNote(piece.id, event.target.value)}
                />
              </div>
              <div className="fb-piece-actions">
                {piece.role !== "file" ? (
                  <button type="button" className="fb-mini" data-nav data-testid="fb-mark" onClick={() => props.onMark(piece.id)}>
                    <PencilIcon />
                    <span>{t("feedback.markUp")}</span>
                  </button>
                ) : null}
                <button type="button" className="fb-mini fb-mini-quiet" data-nav data-testid="fb-remove" aria-label={t("feedback.removePiece", { name: piece.name })} onClick={() => props.onRemove(piece.id)}>
                  <CloseIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
