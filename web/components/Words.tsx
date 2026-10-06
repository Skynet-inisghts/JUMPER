import { Fragment } from "react";

/**
 * Text split into word spans (class "w") so a crawler can land on one of
 * them; the React form of the prototype's wrapWords().
 */
export default function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        part.trim() ? <span key={i} className="w">{part}</span> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
