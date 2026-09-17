type LessonPageModeInput = {
  isProduction: boolean;
  preview: string | null;
};

export function lessonPageMode({ isProduction, preview }: LessonPageModeInput): "preview" | "protected" {
  return !isProduction && preview === "1" ? "preview" : "protected";
}
