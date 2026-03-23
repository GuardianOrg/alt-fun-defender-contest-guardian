import { motion } from "framer-motion";
import { useParams, Navigate } from "react-router";

import styles from "./BlogDetailPage.module.css";
import Seo from "../../components/Global/Seo";
import { getBlogPostBySlug } from "../../data/blog-posts";

const BlogDetailPage = () => {
  const { slug } = useParams();
  const post = getBlogPostBySlug(slug as string);

  if (!post) {
    return <Navigate to="*" replace />;
  }

  return (
    <>
      <Seo title={post.seoTitle} description={post.seoDescription} />
      <div className={`globalPage ${styles.blogDetailPage}`}>
        <motion.div
          className={styles.blogDetailWrapper}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className={styles.blogDetailHeader}>
            <h1 className={styles.blogDetailTitle}>{post.title}</h1>
            <div className={styles.blogMeta}>
              <span className={styles.blogDate}>
                {new Date(post.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <span className={styles.blogCategory}>{post.category}</span>
            </div>
          </div>

          <div
            className={styles.blogContent}
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </motion.div>
      </div>
    </>
  );
};

export default BlogDetailPage;
